// Copyright (c) 2015-present Mattermost, Inc. All Rights Reserved.
// See LICENSE.txt for license information.

import manifest from 'manifest';
import type {Store} from 'redux';
import type {GlobalState} from '@mattermost/types/store';
import type {PluginRegistry} from 'types/mattermost-webapp';

import UploadPanel from './components/upload_panel';
import UploadIcon from './components/upload_icon';

export default class Plugin {
    public async initialize(registry: PluginRegistry, store: Store<GlobalState>) {
        const {toggleRHSPlugin} = registry.registerRightHandSidebarComponent(
            UploadPanel,
            'Picture Dump',
        );

        registry.registerChannelHeaderButtonAction(
            UploadIcon,
            () => store.dispatch(toggleRHSPlugin),
            'Picture Dump',
            'Upload files to Picture Dump',
        );
    }
}

declare global {
    interface Window {
        registerPlugin(pluginId: string, plugin: Plugin): void;
    }
}

window.registerPlugin(manifest.id, new Plugin());
