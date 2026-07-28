// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from 'manifest';
import type {Store} from 'redux';

import type {GlobalState} from '@mattermost/types/store';

import type {PluginRegistry} from 'types/mattermost-webapp';

import UploadIcon from './components/upload_icon';
import UploadPanel from './components/upload_panel';

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState>) {
        const {toggleRHSPlugin} = registry.registerRightHandSidebarComponent(
            UploadPanel,
            'File Dump',
        );

        registry.registerChannelHeaderButtonAction(
            UploadIcon,
            () => store.dispatch(toggleRHSPlugin),
            'File Dump',
            'Upload files to File Dump',
        );
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
