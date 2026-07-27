import manifest from 'manifest';
import React from 'react';

export default function UploadIcon() {
    return (
        <img
            src={`/plugins/${manifest.id}/public/picture-dump-icon.webp`}
            alt='Picture Dump'
            style={{width: 20, height: 20, verticalAlign: 'middle'}}
        />
    );
}
