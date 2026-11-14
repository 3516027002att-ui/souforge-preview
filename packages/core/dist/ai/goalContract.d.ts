export type GoalKind = 'read' | 'diagnose' | 'modify' | 'revert';
export type GoalState = 'unresolved' | 'candidate' | 'resolved' | 'planned' | 'staged' | 'committed' | 'verified' | 'blocked' | 'cancelled' | 'recovery_required' | 'already_satisfied';
export interface GoalContract {
    goalId: string;
    requestRef: string;
    kind: GoalKind;
    targetScope: string;
    expectedCondition: string;
    required: boolean;
    dependencies: string[];
    state: GoalState;
    evidenceRefs: string[];
    currentNativeProof?: boolean | undefined;
    transactionId?: string | undefined;
}
export interface TransactionOutcome {
    id: string;
    state: 'staged' | 'committed' | 'verified' | 'recovery_required' | 'failed';
    postconditions: string[];
}
export declare function validateGoalContract(goals: readonly GoalContract[]): void;
export declare function evaluateGoalCompletion(goals: readonly GoalContract[], outcomes: readonly TransactionOutcome[]): 'success' | 'partial' | 'blocked' | 'recovery_required';
export declare function goalStateAfterNativeRead(goal: GoalContract, proof: boolean): GoalContract;
