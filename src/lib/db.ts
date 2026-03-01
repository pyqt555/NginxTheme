// lib/filelist-db.ts

const DB_NAME = "file";
const STORE_NAME = "file";
const DB_VERSION = 1;

export class FilelistDB {
  private static dbConnection: Promise<IDBDatabase> | null = null;
  //private static filelist=null;
  private static file;
  private version: string;

  private worker: Worker | null = null;
  private workerPromiseMap = new Map<
    string,
    {
      resolve: (matches: string[]) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  constructor(version: string) {

    this.version = version;
    //console.log(version);
    //FilelistDB.filelist=null;
    //this.getFileList();
  }

  private static async getConnection(): Promise<IDBDatabase> {
    if (FilelistDB.dbConnection) return FilelistDB.dbConnection;

    FilelistDB.dbConnection = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {

        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "version" });
        }

      };
    });

    return FilelistDB.dbConnection;
  }



  async getFileList(): Promise<string | undefined> {
    if (FilelistDB.file) return FilelistDB.file;
    const db = await FilelistDB.getConnection();
    FilelistDB.file = new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        //console.log(result);
        resolve(result?.file);
      };
    });
    return FilelistDB.file
  }
  async getFileList_NoCache(): Promise<string | undefined> {

    const db = await FilelistDB.getConnection();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const result = request.result;
        //console.log(result);
        resolve(result?.file);
      };
    });

  }

  async saveFileList(file: string): Promise<void> {

    FilelistDB.file = null;
    const db = await FilelistDB.getConnection();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put({ version: this.version, file });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });

  }

  async deleteFileList(): Promise<void> {
    const db = await FilelistDB.getConnection();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.delete(this.version);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  }






  /**
   * Search the file list of this version using a regular expression.
   * The search runs in a Web Worker if supported.
   * @param query The RegExp to test against each filename
   * @returns Array of matching filenames
   */
  async searchFileList(query): Promise<string[]> {
    const start = Date.now();
    //const start3 = Date.now();
    const file = await this.getFileList();
    console.log("files-fetch: "+(Date.now()-start));
    if (!file) return [];
    //console.log(FilelistDB.file);
    // Fallback to main thread if workers are not supported
    //if (typeof Worker === "undefined") {
    //console.log("regex: "+regex);
    //const start = Date.now();
    const start2 = Date.now();
    let res = file.match(query);
    console.log("query: "+(Date.now()-start2));
    //console.log(res);//files.filter((file) => regex.test(file));
    //console.log("main-thered-search: "+(Date.now()-start));
    //console.log("total-search: "+(Date.now()-start2));

    return res;
    /*}
    const start4 = Date.now();
    this.initWorker();
    console.log("worker-setup: "+(Date.now()-start4));
    const requestId = Math.random().toString(36).substring(2) + Date.now();
    const start5= Date.now();
    return new Promise<string[]>((resolve, reject) => {
      this.workerPromiseMap.set(requestId, { resolve, reject });

      // biome-ignore lint/style/noNonNullAssertion: debug
      this.worker!.postMessage({
        type: "search",
        files,
        pattern: regex.source,
        flags: regex.flags,
        requestId,
      });
    }).then((data) =>{console.log(("total-search,since_worker: "+(Date.now()-start2))+","+(Date.now()-start5));return data;});
    */

  }

  private initWorker() {
    if (this.worker) return;

    const workerCode = `
      self.onmessage = (e) => {
        const { type, files, pattern, flags, requestId } = e.data;
        if (type === 'search') {
          try {
            const regex = new RegExp(pattern, flags);
            const start = Date.now();
            const matches =files.filter(file => regex.test(file));
            console.log("2nd-thread-search: "+(Date.now()-start));
            self.postMessage({ type: 'result', matches, requestId });
          } catch (err) {
            self.postMessage({ type: 'error', error: err.message, requestId });
          }
        }
      };
    `;
    const blob = new Blob([workerCode], { type: "application/javascript" });
    this.worker = new Worker(URL.createObjectURL(blob));

    this.worker.onmessage = (e) => {
      const { type, matches, error, requestId } = e.data;
      const promise = this.workerPromiseMap.get(requestId);
      if (!promise) return;

      if (type === "result") {
        promise.resolve(matches);
      } else if (type === "error") {
        promise.reject(new Error(error));
      }
      this.workerPromiseMap.delete(requestId);
    };

    this.worker.onerror = (err) => {
      this.workerPromiseMap.forEach((p) => {
        p.reject(err);
      });
      this.workerPromiseMap.clear();
    };
  }

  dispose() {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.workerPromiseMap.clear();
    }
  }
}
