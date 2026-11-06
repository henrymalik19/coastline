import type { Debt, DebtKind } from "@coastfi/engine";

/**
 * Debt types offered as choices. `typicalApr` is a round ballpark used to pre-fill a
 * new debt's rate (the user should replace it with their real rate).
 */
export const DEBT_KINDS: { value: DebtKind; label: string; typicalApr: number; placeholder: string; note?: string }[] = [
  { value: "credit_card", label: "Credit card", typicalApr: 0.22, placeholder: "e.g. Chase Sapphire" },
  { value: "car", label: "Car loan", typicalApr: 0.07, placeholder: "e.g. Honda Civic" },
  { value: "student", label: "Student loan", typicalApr: 0.055, placeholder: "e.g. Federal loans" },
  {
    value: "mortgage",
    label: "Mortgage",
    typicalApr: 0.065,
    placeholder: "e.g. Home loan",
    note: "If your mortgage payment is already in your budget (Housing), remove it there so it isn't counted twice.",
  },
  { value: "personal", label: "Personal loan", typicalApr: 0.12, placeholder: "e.g. SoFi loan" },
  { value: "medical", label: "Medical", typicalApr: 0, placeholder: "e.g. Hospital bill" },
  { value: "other", label: "Other", typicalApr: 0.1, placeholder: "e.g. Family loan" },
];

export const debtKind = (k?: DebtKind) => DEBT_KINDS.find((d) => d.value === (k ?? "other")) ?? DEBT_KINDS[DEBT_KINDS.length - 1]!;

/** What to call a debt on screen: its name, else its type. */
export const debtLabel = (d: Pick<Debt, "name" | "kind">) => d.name.trim() || debtKind(d.kind).label;
