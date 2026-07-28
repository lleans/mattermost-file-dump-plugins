import manifest from 'manifest';
import React from 'react';

export default function UploadIcon() {
    return (
        <img
            src={`/plugins/${manifest.id}/public/file-dump-icon.webp`}
            alt='File Dump'
            style={{width: 20, height: 20, verticalAlign: 'middle'}}
        />
    );
}
