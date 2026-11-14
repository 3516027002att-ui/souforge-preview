/** Cancellation must not publish the first completed child of a batch. */
export declare function runNativeSemanticRefreshCancellationSmoke(): Promise<void>;
/** A failed/partial source must not resurrect the old projection on commit. */
export declare function runNativeSemanticRefreshSourceAtomicitySmoke(): Promise<void>;
/** Source-scoped postcommit analysis is disposable and must not duplicate a full changed PARAM/MSG projection. */
export declare function runNativeSemanticRefreshOwnedIndexSmoke(): Promise<void>;
/** Full PARAM payload rereads must not fan out several large table documents at once. */
export declare function runNativeParamReadConcurrencySmoke(): Promise<void>;
/** A disposable PARAM candidate publishes each decoded table before the next heavy native read starts. */
export declare function runNativeParamRefreshStreamsTablesSmoke(): Promise<void>;
