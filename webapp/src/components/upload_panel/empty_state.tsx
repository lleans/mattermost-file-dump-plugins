import React from 'react';

export default function EmptyState() {
    return (
        <div className='picture-dump-empty-state'>
            <svg
                className='picture-dump-empty-state__illustration'
                viewBox='0 0 220 160'
                aria-hidden='true'
            >
                <circle
                    cx='110'
                    cy='88'
                    r='70'
                    fill='var(--center-channel-color-04, rgba(63, 67, 80, 0.04))'
                />
                <rect
                    x='30'
                    y='30'
                    width='120'
                    height='76'
                    rx='10'
                    fill='var(--center-channel-bg, #fff)'
                    stroke='var(--center-channel-color-24, rgba(63, 67, 80, 0.24))'
                    strokeWidth='2'
                />
                <polygon
                    points='46,106 46,124 64,106'
                    fill='var(--center-channel-bg, #fff)'
                    stroke='var(--center-channel-color-24, rgba(63, 67, 80, 0.24))'
                    strokeWidth='2'
                />
                <circle
                    cx='55'
                    cy='50'
                    r='7'
                    fill='var(--center-channel-color-24, rgba(63, 67, 80, 0.24))'
                />
                <rect
                    x='70'
                    y='46'
                    width='60'
                    height='7'
                    rx='3.5'
                    fill='var(--center-channel-color-16, rgba(63, 67, 80, 0.16))'
                />
                <rect
                    x='46'
                    y='66'
                    width='90'
                    height='7'
                    rx='3.5'
                    fill='var(--center-channel-color-16, rgba(63, 67, 80, 0.16))'
                />
                <rect
                    x='46'
                    y='82'
                    width='60'
                    height='7'
                    rx='3.5'
                    fill='var(--center-channel-color-16, rgba(63, 67, 80, 0.16))'
                />
                <rect
                    x='118'
                    y='86'
                    width='66'
                    height='46'
                    rx='10'
                    fill='var(--button-bg, #1c58d9)'
                />
                <polygon
                    points='150,132 150,146 166,132'
                    fill='var(--button-bg, #1c58d9)'
                />
                <rect
                    x='130'
                    y='98'
                    width='42'
                    height='6'
                    rx='3'
                    fill='rgba(255, 255, 255, 0.7)'
                />
                <rect
                    x='130'
                    y='110'
                    width='30'
                    height='6'
                    rx='3'
                    fill='rgba(255, 255, 255, 0.7)'
                />
                <circle
                    cx='150'
                    cy='42'
                    r='18'
                    fill='var(--button-bg, #1c58d9)'
                />
                <rect
                    x='141'
                    y='35'
                    width='18'
                    height='14'
                    rx='2'
                    fill='none'
                    stroke='#fff'
                    strokeWidth='1.6'
                />
                <circle
                    cx='146'
                    cy='40'
                    r='1.8'
                    fill='#fff'
                />
                <polyline
                    points='141,47 147,41 151,45 159,37'
                    fill='none'
                    stroke='#fff'
                    strokeWidth='1.6'
                    strokeLinecap='round'
                    strokeLinejoin='round'
                />
            </svg>
            <div className='picture-dump-empty-state__title'>{'Picture Dump'}</div>
            <div className='picture-dump-empty-state__description'>
                {'Drag and drop images or files below to instantly generate a shareable link.'}
            </div>
        </div>
    );
}
