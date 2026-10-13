import type { UploadFile } from '../../shared/types';

function toFile({ name, type, base64 }: UploadFile): File {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new File([bytes], name, { type });
}

/**
 * Attaches a file to an upload input the way a drop would. Throws when the page does not
 * keep it, so the field can be handed back to the user.
 */
export function attachFile(input: HTMLInputElement, upload: UploadFile): void {
  const transfer = new DataTransfer();
  transfer.items.add(toFile(upload));
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  if (input.files[0]?.name !== upload.name) {
    throw new Error('The page did not accept the file');
  }
}
