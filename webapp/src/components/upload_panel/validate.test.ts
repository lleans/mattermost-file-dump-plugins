import {validateFile, validateBatch, MAX_FILE_SIZE} from './validate';

function makeFile(name: string, size: number): File {
    return new File([new Uint8Array(size)], name);
}

describe('validateFile', () => {
    it('accepts an allowed image under the size limit', () => {
        expect(validateFile(makeFile('photo.png', 1024))).toBeNull();
    });

    it('rejects a disallowed extension', () => {
        expect(validateFile(makeFile('script.exe', 1024))).toContain('not an allowed file type');
    });

    it('rejects a file over the size limit', () => {
        expect(validateFile(makeFile('big.png', MAX_FILE_SIZE + 1))).toContain('10MB size limit');
    });
});

describe('validateBatch', () => {
    it('accepts a batch of 10 files', () => {
        const files = Array.from({length: 10}, (_, i) => makeFile(`f${i}.png`, 100));
        expect(validateBatch(files)).toBeNull();
    });

    it('rejects a batch of 11 files', () => {
        const files = Array.from({length: 11}, (_, i) => makeFile(`f${i}.png`, 100));
        expect(validateBatch(files)).toContain('up to 10 files');
    });
});
