export type UploadStatus = 'pending' | 'uploading' | 'done' | 'error';

export interface UploadItem {
    id: string;
    file: File;
    status: UploadStatus;
    progress: number; // 0-100
    publicUrl?: string;
    objectKey?: string;
    error?: string;
}
