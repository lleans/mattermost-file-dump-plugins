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

    const isImage = item.file.type.startsWith('image/');

    return (
        <div className='picture-dump-file-row'>
            <div className='picture-dump-file-row__header'>
                <i className={`icon ${isImage ? 'icon-file-image-outline' : 'icon-file-outline'} picture-dump-file-row__file-icon`}/>
                <div
                    className='picture-dump-file-row__name'
                    title={item.file.name}
                >
                    {item.file.name}
                </div>
            </div>
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
                    <i className='icon icon-link-variant picture-dump-file-row__link-icon'/>
                    {/* eslint-disable-next-line @mattermost/use-external-link */}
                    <a
                        className='picture-dump-file-row__link'
                        href={item.publicUrl}
                        target='_blank'
                        rel='noopener noreferrer'
                        title={item.publicUrl}
                    >
                        {item.publicUrl}
                    </a>
                    <button
                        className='picture-dump-file-row__copy-btn'
                        onClick={handleCopy}
                        aria-label={copied ? 'Copied' : 'Copy link'}
                        title={copied ? 'Copied' : 'Copy link'}
                    >
                        <i className={`icon ${copied ? 'icon-check' : 'icon-content-copy-outline'}`}/>
                        <span>{copied ? 'Copied!' : 'Copy link'}</span>
                    </button>
                </div>
            )}
            {item.status === 'error' && (
                <div className='picture-dump-file-row__error'>
                    <i className='icon icon-alert-outline picture-dump-file-row__error-icon'/>
                    <span className='picture-dump-file-row__error-text'>{item.error}</span>
                    <button
                        className='picture-dump-file-row__retry-btn'
                        onClick={() => onRetry(item.id)}
                        aria-label='Retry'
                        title='Retry'
                    >
                        <i className='icon icon-refresh'/>
                        <span>{'Retry'}</span>
                    </button>
                </div>
            )}
        </div>
    );
}
