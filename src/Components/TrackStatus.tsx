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

import { Box, Text } from "ink";
import { TrackStatus as TrackStatusType } from "../Types.js";

type TrackStatusProps = {
  current: TrackStatusType;
};

const TrackStatus = ({ current }: TrackStatusProps) => (
  <Box
    alignItems="center"
    borderStyle="round"
    flexDirection="column"
    justifyContent="flex-start"
    paddingLeft={1}
    paddingRight={1}
  >
    <Box
      borderStyle="round"
      paddingLeft={1}
      paddingRight={1}
    >
      <Text>Track Status</Text>
    </Box>
    <Box
      alignItems="stretch"
      flexDirection="row"
      flexWrap="nowrap"
      justifyContent="flex-start"
    >
      <Box
        alignItems="flex-end"
        borderStyle="round"
        flexDirection="column"
        justifyContent="flex-start"
      >
        <Text>Status</Text>
        <Text>Message</Text>
      </Box>
      <Box
        alignItems="flex-start"
        borderStyle="round"
        flexDirection="column"
        justifyContent="flex-start"
      >
        <Text
          color={
            current.Status === "1" || current.Status === "3" ?
              "#00FF00" : // green
              current.Status === "2" ?
              "#FFFF00" : // yellow
              current.Status === "4" || current.Status == "6" ?
              "#FFA500" : // orange
              current.Status === "5" ?
              "#FF0000" : // red
              undefined
          }
        >{current.Status}</Text>
        <Text
          color={
            current.Message === "AllClear" || current.Message === "Green" ?
              "#00FF00" : // green
              current.Message === "Yellow" ?
              "#FFFF00" : // yellow
              current.Message === "SCDeployed" || current.Message == "VSCDeployed" ?
              "#FFA500" : // orange
              current.Message === "Red" ?
              "#FF0000" : // red
              undefined
          }
        >{current.Message}</Text>
      </Box>
    </Box>
  </Box>
);

export default TrackStatus;
