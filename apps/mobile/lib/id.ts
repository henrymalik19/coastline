/** Short random id for plan items (incomes, budget lines, debts, goals). */
export const newId = () => Math.random().toString(36).slice(2, 9);
