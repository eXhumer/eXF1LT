// eXF1LT - Live Timing client for Formula 1
// Copyright (C) 2023  eXhumer

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU Affero General Public License as
// published by the Free Software Foundation, version 3 of the License.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU Affero General Public License for more details.

// You should have received a copy of the GNU Affero General Public License
// along with this program.  If not, see <https://www.gnu.org/licenses/>.

import Gradient from "@exhumer/ink-gradient";
import { Box } from "ink";
import BigText from "ink-big-text";

const Logo = () => (
  <Box borderStyle="round" paddingLeft={3} paddingRight={3}>
    <Gradient name="rainbow">
      <BigText text="eXF1LT" />
    </Gradient>
  </Box>
);

export default Logo;
