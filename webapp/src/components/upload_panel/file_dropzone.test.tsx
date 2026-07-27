import React from 'react';
import {render} from '@testing-library/react';

import FileDropzone from './file_dropzone';

describe('FileDropzone', () => {
    it('calls onDrop with the dropped files', () => {
        const onDrop = jest.fn();
        const {container} = render(<FileDropzone onDrop={onDrop}/>);
        const dropzone = container.firstChild as HTMLElement;

        const file = new File(['data'], 'photo.png', {type: 'image/png'});
        const dataTransfer = {
            files: [file],
            items: [{kind: 'file', getAsFile: () => file}],
            types: ['Files'],
        };

        const dropEvent = new Event('drop', {bubbles: true, cancelable: true});
        Object.defineProperty(dropEvent, 'dataTransfer', {value: dataTransfer});
        dropzone.dispatchEvent(dropEvent);

        expect(onDrop).toHaveBeenCalledWith([file]);
    });
});
