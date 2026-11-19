/**
 * "Want a copy first?" before a big change that's hard to take back (an update from YNAB, undoing the
 * import, starting over, restoring): one tap downloads a backup of everything as it is now.
 */
import { useState } from "react";
import { Platform, Pressable, Text, View } from "react-native";
import { downloadBackup } from "../lib/backup";
import { space, type, useTheme } from "../lib/theme";
import { Icon } from "./Icon";

export function BackupFirst() {
  const t = useTheme();
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, flexWrap: "wrap" }}>
      {done ? (
        <>
          <Icon name="check" size={14} color={t.good} />
          <Text style={[type.caption, { color: t.text2 }]}>Backup {Platform.OS === "web" ? "downloaded" : "ready"}. Restore it from Settings → Backup & restore if you need to.</Text>
        </>
      ) : (
        <>
          <Text style={[type.caption, { color: t.text2 }]}>Want a copy of everything as it is now?</Text>
          <Pressable
            role="button"
            hitSlop={6}
            onPress={() => {
              setError(false);
              downloadBackup().then(() => setDone(true), () => setError(true));
            }}
          >
            <Text style={[type.caption, { color: t.accent, fontWeight: "700" }]}>{Platform.OS === "web" ? "Download a backup" : "Save a backup"}</Text>
          </Pressable>
          {error ? <Text style={[type.caption, { color: t.bad }]}>Couldn't make the backup.</Text> : null}
        </>
      )}
    </View>
  );
}
