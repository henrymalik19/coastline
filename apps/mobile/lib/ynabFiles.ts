import { parseYnab, readYnabZip, type YnabData } from "./ynab";

/** Read the picked file: YNAB's zip, or its Register CSV (with its Plan CSV if picked too). */
export async function readYnabFiles(files: FileList): Promise<YnabData> {
  const list = [...files];
  const zip = list.find((f) => /\.zip$/i.test(f.name));
  if (zip) {
    const { register, plan } = readYnabZip(new Uint8Array(await zip.arrayBuffer()));
    return parseYnab(register, plan);
  }
  const reg = list.find((f) => /register/i.test(f.name)) ?? list.find((f) => /\.csv$/i.test(f.name));
  if (!reg) throw new Error("Pick the zip YNAB exports (or its Register CSV).");
  const plan = list.find((f) => f !== reg && /(plan|budget)\.csv$/i.test(f.name));
  return parseYnab(await reg.text(), plan ? await plan.text() : undefined);
}

/** Open the file picker (web) and read what's picked. Resolves null if nothing was picked. */
export function pickYnabFiles(): Promise<{ data: YnabData; name: string } | null> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") return resolve(null);
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".zip,.csv";
    input.multiple = true;
    input.onchange = () => {
      const files = input.files;
      if (!files?.length) return resolve(null);
      readYnabFiles(files)
        .then((data) => resolve({ data, name: [...files].find((x) => /\.zip$/i.test(x.name))?.name ?? files[0]?.name ?? "" }))
        .catch(reject);
    };
    input.click();
  });
}
