import { Grid } from 'antd';

/** True below Ant Design `md` (768px). First paint treats unknown width as phone. */
export function useIsPhone() {
  const screens = Grid.useBreakpoint();
  return !screens.md;
}
