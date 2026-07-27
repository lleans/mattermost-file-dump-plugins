import React, {useCallback, useState} from 'react';

import FileDropzone from './file_dropzone';
import type {UploadItem} from './types';
import {validateFile, validateBatch} from './validate';

function makeId(): string {
    return Math.random().toString(36).slice(2);
}

export default function UploadPanel() {
    const [items, setItems] = useState<UploadItem[]>([]);
    const [batchError, setBatchError] = useState<string | null>(null);

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
    }, []);

    return (
        <div className='picture-dump-panel'>
            <FileDropzone onDrop={onDrop}/>
            {batchError && (
                <div className='picture-dump-panel__batch-error'>
                    {batchError}
                </div>
            )}
            <div className='picture-dump-panel__list'>
                {items.map((item) => (
                    <div
                        key={item.id}
                        className='picture-dump-file-row'
                    >
                        <span>{item.file.name}</span>
                        {item.status === 'error' && (
                            <span className='picture-dump-file-row__error'>
                                {item.error}
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}
