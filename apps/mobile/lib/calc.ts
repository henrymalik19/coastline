import { create } from "zustand";

/**
 * Math typed into a number box: "120+35.50", "1500/2", "60*12", "1,200 − 85". Times and divide go
 * before plus and minus. Starting with an operator works on what was there: "+50" adds 50 to it
 * ("-50" too, where the box can't go negative). Returns null while it isn't a whole sum yet ("120+").
 */
export function calc(text: string, before = 0, allowNegative = false): number | null {
  let s = text.replace(/[\s,$]/g, "").replace(/[−–]/g, "-").replace(/[×xX]/g, "*").replace(/÷/g, "/");
  if (!s) return null;
  // a leading operator: on top of what was there (a leading minus is a negative number where that's allowed)
  if (/^[+*/]/.test(s) || (!allowNegative && s.startsWith("-"))) s = String(before) + s;
  if (!/^-?(\d+\.?\d*|\.\d+)([+\-*/](\d+\.?\d*|\.\d+))*$/.test(s)) return null;
  const parts = s.match(/(^-)?(\d+\.?\d*|\.\d+)|[+\-*/]/g);
  if (!parts) return null;
  // times and divide first, then plus and minus, left to right
  const terms: number[] = [];
  let sign = 1;
  let op: string | null = null;
  for (const p of parts) {
    if (p === "+" || p === "-") { sign = p === "-" ? -1 : 1; op = "+"; continue; }
    if (p === "*" || p === "/") { op = p; continue; }
    const n = Number(p);
    if (op === "*") terms[terms.length - 1] *= n;
    else if (op === "/") {
      if (n === 0) return null;
      terms[terms.length - 1] /= n;
    } else terms.push(sign * n);
    sign = 1;
    op = null;
  }
  const total = terms.reduce((a, b) => a + b, 0);
  return Number.isFinite(total) ? Math.round(total * 1e6) / 1e6 : null;
}

/** What a number box keeps of what's typed: digits, a decimal point, and the operators. */
export const mathChars = (text: string, decimals = true) => text.replace(decimals ? /[^\d.+\-*/×÷−]/g : /[^\d+\-*/×÷−]/g, "");

/* ---------- the + − × ÷ keys on phones ---------- */


/** The number box you're typing in, for the keys a phone's number pad doesn't have. */
export type MathTarget = { id: number; key: (k: "+" | "−" | "×" | "÷" | "=") => void };
export const useMathKeys = create<{ target: MathTarget | null }>(() => ({ target: null }));
let seq = 0;
export const mathTargetId = () => ++seq;
/** A touch screen on the web (its number pad has no + or −). */
export const touchScreen = () => typeof document !== "undefined" && typeof window !== "undefined" && !!window.matchMedia?.("(pointer: coarse)").matches;
/** Focus: show the keys for this box. Blur: hide them, unless another box has taken them already. */
export const showMathKeys = (t: MathTarget) => { if (touchScreen()) useMathKeys.setState({ target: t }); };
export const hideMathKeys = (id: number) => { if (useMathKeys.getState().target?.id === id) useMathKeys.setState({ target: null }); };
