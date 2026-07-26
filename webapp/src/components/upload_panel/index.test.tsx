import {render, screen} from '@testing-library/react';
import React from 'react';

import UploadPanel from './index';

describe('UploadPanel', () => {
    it('renders the dropzone prompt', () => {
        render(<UploadPanel/>);
        expect(screen.getByText(/drag and drop files here/i)).toBeInTheDocument();
    });
});
