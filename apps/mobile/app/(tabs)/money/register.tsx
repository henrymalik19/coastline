/**
 * An account's transactions now live in Budget → Transactions (pick the account there; its balance and
 * Reconcile show above the list). Old links land here and go on to it.
 */
import { Redirect, useLocalSearchParams } from "expo-router";
import { accountTxnsHref } from "../../../lib/register";

export default function Register() {
  const { account } = useLocalSearchParams<{ account?: string }>();
  return <Redirect href={(account ? accountTxnsHref(account) : "/budget?view=transactions") as never} />;
}
