export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_BATCH_SIZE = 10;

const ALLOWED_EXTENSIONS = [
    '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
    '.pdf', '.docx', '.xlsx', '.pptx', '.txt', '.zip',
];

export function getExtension(filename: string): string {
    const idx = filename.lastIndexOf('.');
    return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

export function validateFile(file: File): string | null {
    if (file.size > MAX_FILE_SIZE) {
        return `${file.name} exceeds the 10MB size limit`;
    }
    if (!ALLOWED_EXTENSIONS.includes(getExtension(file.name))) {
        return `${file.name} is not an allowed file type`;
    }
    return null;
}

export function validateBatch(files: File[]): string | null {
    if (files.length > MAX_BATCH_SIZE) {
        return `You can only upload up to ${MAX_BATCH_SIZE} files at once`;
    }
    return null;
}
