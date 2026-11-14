export function validateGoalContract(goals) {
    const ids = new Set();
    for (const goal of goals) {
        if (!goal.goalId || ids.has(goal.goalId) || !goal.targetScope || !goal.expectedCondition)
            throw new Error('GOAL_CONTRACT_INVALID');
        ids.add(goal.goalId);
        if (goal.state === 'verified' && goal.currentNativeProof !== true)
            throw new Error('GOAL_VERIFIED_WITHOUT_PROOF');
        for (const dependency of goal.dependencies)
            if (!ids.has(dependency) && !goals.some((candidate) => candidate.goalId === dependency))
                throw new Error('GOAL_DEPENDENCY_UNKNOWN');
    }
}
export function evaluateGoalCompletion(goals, outcomes) {
    validateGoalContract(goals);
    if (goals.some((goal) => goal.state === 'recovery_required') || outcomes.some((outcome) => outcome.state === 'recovery_required'))
        return 'recovery_required';
    const byTransaction = new Map(outcomes.map((outcome) => [outcome.id, outcome]));
    const complete = goals.filter((goal) => goal.required).every((goal) => {
        if (goal.state === 'already_satisfied')
            return goal.currentNativeProof === true;
        if (goal.state !== 'verified' || goal.currentNativeProof !== true)
            return false;
        if (goal.kind === 'read' || goal.kind === 'diagnose')
            return true;
        const transaction = goal.transactionId ? byTransaction.get(goal.transactionId) : undefined;
        return transaction?.state === 'verified' && transaction.postconditions.includes(goal.goalId);
    });
    if (complete)
        return 'success';
    return goals.some((goal) => goal.state === 'verified' || goal.state === 'already_satisfied') ? 'partial' : 'blocked';
}
export function goalStateAfterNativeRead(goal, proof) {
    return proof ? { ...goal, currentNativeProof: true, state: goal.kind === 'read' ? 'already_satisfied' : goal.state } : { ...goal, currentNativeProof: false };
}
//# sourceMappingURL=goalContract.js.map