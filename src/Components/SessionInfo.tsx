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
import { SessionInfo as SessionInfoType } from "../Types.js";

type SessionInfoProps = {
  current: SessionInfoType;
};

const SessionInfo = ({ current }: SessionInfoProps) => (
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
      <Text>Session Info</Text>
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
        <Text>Meeting Name</Text>
        <Text>Meeting Official Name</Text>
        <Text>Session Name</Text>
        <Text>Archive Status</Text>
        <Text>Location</Text>
        <Text>Country</Text>
        <Text>Circuit</Text>
        <Text>Start Date</Text>
        <Text>End Date</Text>
        <Text>GMT Offset</Text>
      </Box>
      <Box
        alignItems="flex-start"
        borderStyle="round"
        flexDirection="column"
        justifyContent="flex-start"
      >
        <Text>{current.Meeting.Name}</Text>
        <Text>{current.Meeting.OfficialName}</Text>
        <Text>{current.Name}</Text>
        <Text>{current.ArchiveStatus.Status}</Text>
        <Text>{current.Meeting.Location}</Text>
        <Text>{current.Meeting.Country.Name}</Text>
        <Text>{current.Meeting.Circuit.ShortName}</Text>
        <Text>{current.StartDate}</Text>
        <Text>{current.EndDate}</Text>
        <Text>{current.GmtOffset}</Text>
      </Box>
    </Box>
  </Box>
);

export default SessionInfo;
