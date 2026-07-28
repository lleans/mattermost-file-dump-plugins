import React, {useCallback, useRef, useState} from 'react';

import {ALLOWED_EXTENSIONS, MAX_BATCH_SIZE, MAX_FILE_SIZE} from './validate';

interface Props {
    onDrop: (files: File[]) => void;
}

const MAX_FILE_SIZE_MB = MAX_FILE_SIZE / (1024 * 1024);

export default function FileDropzone({onDrop}: Props) {
    const [isDragging, setIsDragging] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
            onDrop(files);
        }
    }, [onDrop]);

    const handlePaste = useCallback((event: React.ClipboardEvent<HTMLDivElement>) => {
        const files = Array.from(event.clipboardData.items).
            filter((item) => item.kind === 'file').
            map((item) => item.getAsFile()).
            filter((file): file is File => file !== null);
        if (files.length > 0) {
            event.preventDefault();
            onDrop(files);
        }
    }, [onDrop]);

    const handleBrowseClick = useCallback(() => {
        inputRef.current?.click();
    }, []);

    const handleFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files ?? []);
        if (files.length > 0) {
            onDrop(files);
        }
        event.target.value = '';
    }, [onDrop]);

    return (
        <div
            className={'file-dump-dropzone' + (isDragging ? ' file-dump-dropzone--active' : '')}
            tabIndex={0}
            onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onPaste={handlePaste}
        >
            <div className='file-dump-dropzone__prompt'>
                {'Drag and drop files here, paste an image, or '}
                <button
                    type='button'
                    className='file-dump-dropzone__browse-btn'
                    onClick={handleBrowseClick}
                >
                    {'browse'}
                </button>
            </div>
            <div className='file-dump-dropzone__limits'>
                {'Up to '}
                <strong>{`${MAX_BATCH_SIZE} files`}</strong>
                {', '}
                <strong>{`${MAX_FILE_SIZE_MB}MB`}</strong>
                {' each'}
            </div>
            <input
                ref={inputRef}
                type='file'
                multiple={true}
                accept={ALLOWED_EXTENSIONS.join(',')}
                className='file-dump-dropzone__input'
                aria-label='Browse files to upload'
                onChange={handleFileInputChange}
            />
        </div>
    );
}
