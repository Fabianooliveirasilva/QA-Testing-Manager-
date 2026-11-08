import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText, ImageIcon, Paperclip, Trash2, Upload } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { ALLOWED_UPLOADS, MAX_UPLOAD_BYTES, type AttachmentEntityType } from '@qtm/shared';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { Panel } from '@/components/page';
import { Button } from '@/components/ui/button';
import { api, errorMessage } from '@/lib/api';
import { formatBytes, formatDateTime } from '@/lib/format';
import type { Attachment } from '@/lib/types';

const ACCEPT = Object.keys(ALLOWED_UPLOADS).join(',');

export function AttachmentsPanel({
  projectId,
  entityType,
  entityId,
  writable,
  title = 'Evidence',
}: {
  projectId: string;
  entityType: AttachmentEntityType;
  entityId: string;
  writable: boolean;
  title?: string;
}) {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const queryKey = ['attachments', projectId, entityType, entityId];
  const { data } = useQuery({
    queryKey,
    queryFn: () => api.get<{ items: Attachment[] }>(`/projects/${projectId}/attachments`, { entityType, entityId }).then((r) => r.items),
  });
  const upload = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('entityType', entityType);
      form.append('entityId', entityId);
      form.append('file', file);
      return api.upload<Attachment>(`/projects/${projectId}/attachments`, form);
    },
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey });
      toast.success(`Uploaded ${a.fileName}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/projects/${projectId}/attachments/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (e) => toast.error(errorMessage(e)),
  });

  const onFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`File exceeds ${formatBytes(MAX_UPLOAD_BYTES)}`);
      return;
    }
    upload.mutate(file);
  };

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          <Paperclip className="size-4" /> {title}
        </span>
      }
      actions={
        writable && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              className="sr-only"
              aria-label={`Upload ${title.toLowerCase()}`}
              data-testid={`upload-${entityType.toLowerCase()}`}
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = '';
              }}
            />
            <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => inputRef.current?.click()}>
              <Upload /> {upload.isPending ? 'Uploading…' : 'Upload'}
            </Button>
          </>
        )
      }
    >
      {!data?.length ? (
        <p className="text-sm text-muted-foreground">No files. Allowed: PNG, JPEG, WebP, PDF, TXT, LOG, JSON (max {formatBytes(MAX_UPLOAD_BYTES)}).</p>
      ) : (
        <ul className="divide-y">
          {data.map((a) => {
            const isImage = a.mimeType.startsWith('image/');
            const href = api.url(`/projects/${projectId}/attachments/${a.id}/download`);
            return (
              <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                {isImage ? (
                  <a href={api.url(`/projects/${projectId}/attachments/${a.id}/download`, { inline: 1 })} target="_blank" rel="noopener noreferrer">
                    <img
                      src={api.url(`/projects/${projectId}/attachments/${a.id}/download`, { inline: 1 })}
                      alt={a.fileName}
                      className="size-10 rounded border object-cover"
                      loading="lazy"
                    />
                  </a>
                ) : (
                  <span className="flex size-10 items-center justify-center rounded border bg-muted">
                    {a.mimeType === 'application/pdf' ? <FileText className="size-4" /> : <ImageIcon className="size-4" />}
                  </span>
                )}
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{a.fileName}</span>
                  <span className="text-xs text-muted-foreground">
                    {formatBytes(a.size)} · {a.uploadedBy?.name ?? 'Unknown'} · {formatDateTime(a.createdAt)} ·{' '}
                    {a.scanStatus === 'CLEAN' ? 'malware scan: clean' : 'not malware-scanned'}
                  </span>
                </span>
                <Button asChild variant="ghost" size="icon" aria-label={`Download ${a.fileName}`}>
                  <a href={href} download>
                    <Download />
                  </a>
                </Button>
                {writable && (
                  <ConfirmDialog
                    title="Delete file?"
                    description={`“${a.fileName}” will be permanently removed.`}
                    onConfirm={() => remove.mutateAsync(a.id)}
                    trigger={
                      <Button variant="ghost" size="icon" aria-label={`Delete ${a.fileName}`}>
                        <Trash2 />
                      </Button>
                    }
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
