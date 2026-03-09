import {
  DropdownMenuGroup,
  DropdownMenuGroupLabel,
  DropdownMenuItem,
  DropdownMenuItemIcon,
  DropdownMenuItemLabel,
  DropdownMenuPopup,
  DropdownMenuPortal,
  DropdownMenuPositioner,
  DropdownMenuSubmenuRoot,
  DropdownMenuSubmenuTrigger,
  menuSharedStyles,
} from '@lobehub/ui';
import { cx } from 'antd-style';
import { Check } from 'lucide-react';
import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ModelItemRender, ProviderItemRender } from '@/components/ModelSelect';

import { styles } from '../../styles';
import { type ModelWithProviders } from '../../types';
import { menuKey } from '../../utils';
import ModelDetailPanel from '../ModelDetailPanel';

interface MultipleProvidersModelItemProps {
  activeKey: string;
  data: ModelWithProviders;
  newLabel: string;
  onClose: () => void;
  onModelChange: (modelId: string, providerId: string) => Promise<void>;
  showInfoTag?: boolean;
}

export const MultipleProvidersModelItem = memo<MultipleProvidersModelItemProps>(
  ({ activeKey, data, newLabel, onModelChange, onClose, showInfoTag }) => {
    const { t } = useTranslation('components');
    const [submenuOpen, setSubmenuOpen] = useState(false);

    const activeProvider = data.providers.find((p) => menuKey(p.id, data.model.id) === activeKey);
    const isActive = !!activeProvider;

    return (
      <DropdownMenuSubmenuRoot open={submenuOpen} onOpenChange={setSubmenuOpen}>
        <DropdownMenuSubmenuTrigger
          className={cx(menuSharedStyles.item, isActive && styles.menuItemActive)}
          style={{ paddingBlock: 8, paddingInline: 8 }}
        >
          <ModelItemRender
            {...data.model}
            {...data.model.abilities}
            newBadgeLabel={newLabel}
            showInfoTag={showInfoTag}
          />
        </DropdownMenuSubmenuTrigger>
        <DropdownMenuPortal>
          <DropdownMenuPositioner anchor={null} placement="right" sideOffset={12}>
            <DropdownMenuPopup className={cx(styles.detailPopup, styles.dropdownMenu)}>
              {showInfoTag && (
                <ModelDetailPanel
                  model={data.model.id}
                  provider={(activeProvider ?? data.providers[0]).id}
                />
              )}
              <DropdownMenuGroup>
                <DropdownMenuGroupLabel>
                  {t('ModelSwitchPanel.useModelFrom')}
                </DropdownMenuGroupLabel>
                {data.providers.map((p) => {
                  const key = menuKey(p.id, data.model.id);
                  const isProviderActive = activeKey === key;

                  return (
                    <DropdownMenuItem
                      key={key}
                      onClick={async () => {
                        await onModelChange(data.model.id, p.id);
                        onClose();
                      }}
                    >
                      <DropdownMenuItemIcon>
                        {isProviderActive ? <Check size={16} /> : null}
                      </DropdownMenuItemIcon>
                      <DropdownMenuItemLabel>
                        <ProviderItemRender
                          logo={p.logo}
                          name={p.name}
                          provider={p.id}
                          size={20}
                          source={p.source}
                          type={'avatar'}
                        />
                      </DropdownMenuItemLabel>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuGroup>
            </DropdownMenuPopup>
          </DropdownMenuPositioner>
        </DropdownMenuPortal>
      </DropdownMenuSubmenuRoot>
    );
  },
);

MultipleProvidersModelItem.displayName = 'MultipleProvidersModelItem';
