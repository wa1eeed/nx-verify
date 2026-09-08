declare module 'vitest' {
  export interface ProvidedContext {
    /** Connection URL of the shared test container, pointing at its bootstrap database. */
    pgBaseUrl: string;
    /** Database that already has every migration applied. Test databases clone it. */
    templateDatabase: string;
  }
}

export {};
