import React, {useState} from 'react';

import type {UploadItem} from './types';

interface Props {
    item: UploadItem;
    onRetry: (id: string) => void;
}

export default function FileRow({item, onRetry}: Props) {
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        if (item.publicUrl) {
            navigator.clipboard.writeText(item.publicUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className='picture-dump-file-row'>
            <div className='picture-dump-file-row__name'>{item.file.name}</div>
            {item.status === 'uploading' && (
                <div className='picture-dump-file-row__progress'>
                    <div
                        className='picture-dump-file-row__progress-bar'
                        style={{width: `${item.progress}%`}}
                    />
                </div>
            )}
            {item.status === 'done' && item.publicUrl && (
                <div className='picture-dump-file-row__done'>
                    {/* eslint-disable-next-line @mattermost/use-external-link */}
                    <a
                        href={item.publicUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                    >
                        {item.publicUrl}
                    </a>
                    <button onClick={handleCopy}>{copied ? 'Copied!' : 'Copy link'}</button>
                </div>
            )}
            {item.status === 'error' && (
                <div className='picture-dump-file-row__error'>
                    <span>{item.error}</span>
                    <button onClick={() => onRetry(item.id)}>{'Retry'}</button>
                </div>
            )}
        </div>
    );
}
