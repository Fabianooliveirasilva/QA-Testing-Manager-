/**
 * Malware scanning abstraction for uploaded evidence.
 *
 * No scanner is bundled: the default implementation reports NOT_SCANNED and the attachment is
 * stored with that status. Uploads are still validated by extension, MIME and content signature,
 * which is NOT malware detection. Set MALWARE_SCANNER=clamav to use the clamd adapter
 * (clamav-scanner.ts); other engines can implement FileScanner.
 */
export type ScanVerdict = { status: 'CLEAN' } | { status: 'NOT_SCANNED' } | { status: 'INFECTED'; signature: string };

export interface FileScanner {
  readonly name: string;
  /** Must throw when no verdict can be produced (unavailable, timeout, bad reply) — never return CLEAN by default. */
  scan(data: Buffer, fileName: string): Promise<ScanVerdict>;
  /** Optional health probe used by the readiness endpoint. */
  ping?(): Promise<boolean>;
}

export class NoopFileScanner implements FileScanner {
  readonly name = 'none';

  async scan(): Promise<ScanVerdict> {
    return { status: 'NOT_SCANNED' };
  }
}
