/** Import from YNAB during setup (the Money tab isn't open until setup is done). */
import ImportYnab from "./(tabs)/money/import";

export default function SetupImport() {
  return <ImportYnab setup />;
}
