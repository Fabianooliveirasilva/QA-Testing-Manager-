/**
 * Malware scanning abstraction for uploaded evidence.
 *
 * No scanner is bundled: the default implementation reports NOT_SCANNED and the attachment is
 * stored with that status. Uploads are still validated by extension, MIME and content signature,
 * which is NOT malware detection. Plug in a real engine (e.g. a ClamAV daemon adapter) by
 * implementing FileScanner and wiring it in server.ts.
 */
export type ScanVerdict = { status: 'CLEAN' } | { status: 'NOT_SCANNED' } | { status: 'INFECTED'; signature: string };

export interface FileScanner {
  readonly name: string;
  scan(data: Buffer, fileName: string): Promise<ScanVerdict>;
}

export class NoopFileScanner implements FileScanner {
  readonly name = 'none';

  async scan(): Promise<ScanVerdict> {
    return { status: 'NOT_SCANNED' };
  }
}
