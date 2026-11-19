/** Download (web) or share (phones) a backup file of everything: plan, transactions, check-ins, YNAB import. */
import { Platform, Share } from "react-native";
import { useStore } from "./store";

export async function downloadBackup(): Promise<void> {
  const json = useStore.getState().exportJson();
  if (Platform.OS === "web") {
    const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `coastwise-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  } else {
    await Share.share({ message: json, title: "Coastwise backup" });
  }
}
