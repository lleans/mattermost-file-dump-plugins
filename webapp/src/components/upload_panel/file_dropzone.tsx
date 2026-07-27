import React, {useCallback, useState} from 'react';

interface Props {
    onDrop: (files: File[]) => void;
}

export default function FileDropzone({onDrop}: Props) {
    const [isDragging, setIsDragging] = useState(false);

    const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        setIsDragging(false);
        const files = Array.from(event.dataTransfer.files);
        if (files.length > 0) {
            onDrop(files);
        }
    }, [onDrop]);

    return (
        <div
            className={'picture-dump-dropzone' + (isDragging ? ' picture-dump-dropzone--active' : '')}
            onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
        >
            {'Drag and drop files here (up to 10, 10MB each)'}
        </div>
    );
}
