export interface CorpusSpec {
    label: string;
    /** Absolute path to the corpus file (raw .emevd or DCX wrapper). */
    path: string;
    registered: boolean;
}
