import {renderHook, act, waitFor} from '@testing-library/react';

import {useUploads} from './use_uploads';

function makeFile(name: string, size = 1024, type = 'image/png'): File {
    return new File([new Uint8Array(size)], name, {type});
}

class FakeXHR {
    upload = {onprogress: null as ((e: ProgressEvent) => void) | null};
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    status = 200;
    open = jest.fn();
    send = jest.fn(() => {
        this.upload.onprogress?.({lengthComputable: true, loaded: 100, total: 100} as ProgressEvent);
        this.onload?.();
    });
}

describe('useUploads', () => {
    beforeEach(() => {
        (global as any).XMLHttpRequest = FakeXHR;
        global.fetch = jest.fn().
            mockResolvedValueOnce({
                ok: true,
                json: async () => [{
                    id: 'irrelevant',
                    uploadUrl: 'https://storage.example.com/presigned',
                    objectKey: 'abc.png',
                    publicUrl: 'https://storage.example.com/bucket/abc.png',
                }],
            } as Response).
            mockResolvedValueOnce({ok: true, json: async () => ({})} as Response);
    });

    it('uploads a valid dropped file and records its public url', async () => {
        const {result} = renderHook(() => useUploads());

        act(() => {
            result.current.onDrop([makeFile('photo.png')]);
        });

        await waitFor(() => expect(result.current.items[0]?.status).toBe('done'));
        expect(result.current.items[0].publicUrl).toBe('https://storage.example.com/bucket/abc.png');
    });

    it('marks a disallowed file type as an error without calling fetch', () => {
        const {result} = renderHook(() => useUploads());

        act(() => {
            result.current.onDrop([makeFile('virus.exe')]);
        });

        expect(result.current.items[0].status).toBe('error');
        expect(global.fetch).not.toHaveBeenCalled();
    });
});
