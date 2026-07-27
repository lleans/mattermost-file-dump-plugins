import React from 'react';

import './upload_panel.scss';

import FileDropzone from './file_dropzone';
import FileRow from './file_row';
import {useUploads} from './use_uploads';

export default function UploadPanel() {
    const {items, batchError, onDrop, retry} = useUploads();

    return (
        <div className='picture-dump-panel'>
            <FileDropzone onDrop={onDrop}/>
            {batchError && <div className='picture-dump-panel__batch-error'>{batchError}</div>}
            <div className='picture-dump-panel__list'>
                {items.map((item) => (
                    <FileRow
                        key={item.id}
                        item={item}
                        onRetry={retry}
                    />
                ))}
            </div>
        </div>
    );
}
