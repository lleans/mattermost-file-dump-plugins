import {useCallback, useState} from 'react';

import type {UploadItem, UploadStatus} from './types';
import {requestPresignedUrls, uploadFile, confirmUpload} from './upload_client';
import {validateFile, validateBatch} from './validate';

function makeId(): string {
    return Math.random().toString(36).slice(2);
}

function updateItem(items: UploadItem[], id: string, changes: Partial<UploadItem>): UploadItem[] {
    return items.map((item) => (item.id === id ? {...item, ...changes} : item));
}

export function useUploads() {
    const [items, setItems] = useState<UploadItem[]>([]);
    const [batchError, setBatchError] = useState<string | null>(null);

    const startUpload = useCallback(async (item: UploadItem) => {
        setItems((prev) => updateItem(prev, item.id, {status: 'uploading' as UploadStatus, progress: 0, error: undefined}));

        try {
            const [result] = await requestPresignedUrls([item]);
            if (result.error || !result.uploadUrl || !result.objectKey || !result.publicUrl) {
                setItems((prev) => updateItem(prev, item.id, {status: 'error', error: result.error || 'Failed to prepare upload'}));
                return;
            }

            await uploadFile(item.file, result.uploadUrl, (progress) => {
                setItems((prev) => updateItem(prev, item.id, {progress}));
            });

            await confirmUpload(result.objectKey, item.file.name, item.file.size);

            setItems((prev) => updateItem(prev, item.id, {
                status: 'done',
                progress: 100,
                publicUrl: result.publicUrl,
                objectKey: result.objectKey,
            }));
        } catch (err) {
            setItems((prev) => updateItem(prev, item.id, {status: 'error', error: (err as Error).message}));
        }
    }, []);

    const onDrop = useCallback((files: File[]) => {
        setBatchError(null);

        const batchIssue = validateBatch(files);
        if (batchIssue) {
            setBatchError(batchIssue);
            return;
        }

        const newItems: UploadItem[] = files.map((file) => {
            const validationError = validateFile(file);
            return {
                id: makeId(),
                file,
                status: validationError ? 'error' : 'pending',
                progress: 0,
                error: validationError || undefined,
            };
        });

        setItems((prev) => [...prev, ...newItems]);

        newItems.
            filter((item) => item.status === 'pending').
            forEach((item) => {
                startUpload(item);
            });
    }, [startUpload]);

    const retry = useCallback((id: string) => {
        setItems((prev) => {
            const item = prev.find((i) => i.id === id);
            if (item) {
                startUpload({...item, status: 'pending', error: undefined});
            }
            return prev;
        });
    }, [startUpload]);

    return {items, batchError, onDrop, retry};
}
