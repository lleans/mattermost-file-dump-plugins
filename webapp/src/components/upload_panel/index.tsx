import React from 'react';

export default function UploadPanel() {
    return (
        <div className='picture-dump-panel'>
            <div className='picture-dump-dropzone'>
                {'Drag and drop files here (up to 10, 10MB each)'}
            </div>
        </div>
    );
}
