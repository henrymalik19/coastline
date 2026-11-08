import { Redirect } from "expo-router";

/** Transactions moved into the Budget tab (Budget → Transactions); old links still land there. */
export default function TransactionsRedirect() {
  return <Redirect href="/budget?view=transactions" />;
}
