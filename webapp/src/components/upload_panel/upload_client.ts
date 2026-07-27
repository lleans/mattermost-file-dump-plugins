import type {UploadItem} from './types';

interface PresignRequestItem {
    id: string;
    filename: string;
    size: number;
    contentType: string;
}

interface PresignResultItem {
    id: string;
    uploadUrl?: string;
    objectKey?: string;
    publicUrl?: string;
    error?: string;
}

const API_BASE = '/plugins/com.acumenstrategy.picture-dump/api/v1';

export async function requestPresignedUrls(items: UploadItem[]): Promise<PresignResultItem[]> {
    const body: PresignRequestItem[] = items.map((item) => ({
        id: item.id,
        filename: item.file.name,
        size: item.file.size,
        contentType: item.file.type,
    }));

    const response = await fetch(`${API_BASE}/uploads/presign`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });

    if (!response.ok) {
        throw new Error('Failed to request upload URLs');
    }

    return response.json();
}

export function uploadFile(file: File, uploadUrl: string, onProgress: (percent: number) => void): Promise<void> {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', uploadUrl);
        xhr.upload.onprogress = (event) => {
            if (event.lengthComputable) {
                onProgress(Math.round((event.loaded / event.total) * 100));
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                resolve();
            } else {
                reject(new Error(`Upload failed with status ${xhr.status}`));
            }
        };
        xhr.onerror = () => reject(new Error('Network error during upload'));
        xhr.send(file);
    });
}

export async function confirmUpload(objectKey: string, filename: string, size: number): Promise<void> {
    const response = await fetch(`${API_BASE}/uploads/complete`, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({objectKey, filename, size}),
    });

    if (!response.ok) {
        throw new Error('Failed to confirm upload');
    }
}
