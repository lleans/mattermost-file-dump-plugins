import React from 'react';

import './upload_panel.scss';

import EmptyState from './empty_state';
import FileDropzone from './file_dropzone';
import FileRow from './file_row';
import {useUploads} from './use_uploads';

export default function UploadPanel() {
    const {items, batchError, onDrop, retry} = useUploads();

    return (
        <div className='file-dump-panel'>
            {items.length === 0 && <EmptyState/>}
            <FileDropzone onDrop={onDrop}/>
            <div className='file-dump-panel__disclaimer'>
                <i className='icon icon-information-outline file-dump-panel__disclaimer-icon'/>
                <span>{'This panel doesn’t save anything. Closing it clears the list below, so copy any links you need first.'}</span>
            </div>
            {batchError && <div className='file-dump-panel__batch-error'>{batchError}</div>}
            <div className='file-dump-panel__list'>
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
