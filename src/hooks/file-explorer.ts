import { FilelistDB } from "@lib/db";
import { escapeRegex } from "@lib/utils";
import type { SearchResult } from "@typings/search";
import { useCallback, useRef, useState } from "react";
import { useIndex } from "./nginx-index";
import { useSearch } from "./search";

const RAW_HOST = "https://raw.communitydragon.org";

export const useFileExplorer = () => {
  const { path } = useIndex();
  const { mode, setLoading } = useSearch();
  const [results, setResults] = useState<SearchResult[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const useRegex = false;
  // Refs to store version and DB instance across renders
  const versionKeyRef = useRef<string | null>(null);
  const dbInstanceRef = useRef<FilelistDB | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Get current patch from path
  const getPatch = useCallback(() => {
    const parts = path.split("/");
    return parts[1] || "latest";
  }, [path]);

  // Compute local prefix based on current path and mode
  const localPrefix = useCallback(() => {
    if (mode !== "local") return "";
    if (!path) return "";
    const parts = path.split("/").filter((p) => p.trim() !== "");
    if (parts.length >= 3) {
      return escapeRegex(parts.slice(2, -1).join("/"));
    }
    return "";
  }, [path, mode]);

  // Resolve version key from content-metadata.json or fallback to patch
  const resolveVersionKey = useCallback(
    async (patch: string): Promise<string> => {
      try {
        const metadataUrl = `${RAW_HOST}/${patch}/content-metadata.json`;
        const response = await fetch(metadataUrl);
        if (response.ok) {
          const metadata = await response.json();
          return metadata.version;
        }
      } catch { }
      return patch;
    },
    [],
  );

  // Clean up previous search and DB instance when patch changes
  const currentPatch = getPatch();
  const previousPatchRef = useRef(currentPatch);
  if (previousPatchRef.current !== currentPatch) {
    // Patch changed – reset everything
    if (dbInstanceRef.current) {
      dbInstanceRef.current.dispose();
      dbInstanceRef.current = null;
    }
    versionKeyRef.current = null;
    setResults([]);
    setError(null);
    previousPatchRef.current = currentPatch;
  }

  /**
   * Perform a search with the given query string.
   * @param query The user's search input
   */
  const search = useCallback(
    async (query: string) => {
      const trimmedQuery = query.trim();
      if (!trimmedQuery) {
        setResults([]);
        return;
      }

      // Cancel any ongoing search
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      setLoading(true);
      setError(null);

      try {
        const patch = getPatch();

        // Resolve version if not already known
        let versionKey = versionKeyRef.current;
        if (!versionKey) {
          versionKey = await resolveVersionKey(patch);
          versionKeyRef.current = versionKey;
          // Create new DB instance for this version
          if (dbInstanceRef.current) {
            dbInstanceRef.current.dispose();
          }
          dbInstanceRef.current = new FilelistDB(versionKey);
        }

        const db = dbInstanceRef.current;

        // Get file list from cache or network
        let file = await db.getFileList_NoCache();
        if (!file) {
          const filelistUrl = `${RAW_HOST}/${patch}/cdragon/files.exported.txt`;
          const response = await fetch(filelistUrl, {
            signal: abortController.signal,
          });
          if (!response.ok) throw new Error("Failed to fetch file list");
          const text = await response.text();
          //console.log("test_117"+text.split("\n"));
          //const text=text2
          //file=await text.split("\n").filter((line) => line.trim() !== "");
          //console.log("raw filelist"+text);
          db.saveFileList(text);
        }

        // Build regex with local prefix if in local mode

        const prefix = localPrefix();

        let matches;
        if (!useRegex) {
          let pt_Query = escapeRegex(trimmedQuery);
         
          let regex : RegExp;
          try {
            regex = new RegExp(`^${prefix}.*?(?:${pt_Query}).*$`, "gim");

          } catch (e) {
            console.error("Invalid regex", e);
            setResults([]);
            return;
          }
          matches = await db.searchFileList(regex);
        }
        else {
          let regex: RegExp;
          try {
            regex = new RegExp(`^${prefix}.*?(?:${trimmedQuery}).*$`, "gim");

          } catch (e) {
            console.error("Invalid regex", e);
            setResults([]);
            return;
          }
          matches = await db.searchFileList(regex);
        }

        // Perform search (worker‑based)

        const currentPatch = getPatch();
        if (matches) {
          setResults(
            matches.map((filename) => ({
              filename,
              href: `/${currentPatch}/${filename}`,
            })),
          );
        }
        else {
          setResults(
            []
          );
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        setError(err instanceof Error ? err : new Error(String(err)));
      } finally {
        setLoading(false);
      }
    },
    [getPatch, localPrefix, resolveVersionKey, setLoading],
  );

  // Clean up on unmount
  const dispose = useCallback(() => {
    if (dbInstanceRef.current) {
      dbInstanceRef.current.dispose();
      dbInstanceRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  }, []);

  return { search, results, error, dispose };
};
