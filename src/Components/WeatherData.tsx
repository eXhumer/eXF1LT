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
import { WeatherData as WeatherDataType } from "../Types.js";

type WeatherDataProps = {
  current: WeatherDataType;
};

const WeatherData = ({ current }: WeatherDataProps) => (
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
      <Text>Weather Data</Text>
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
        <Text>Air Temperature</Text>
        <Text>Humidity</Text>
        <Text>Pressure</Text>
        <Text>Track Status</Text>
        <Text>Track Temperature</Text>
        <Text>Wind Direction</Text>
        <Text>Wind Speed</Text>
      </Box>
      <Box
        alignItems="flex-start"
        borderStyle="round"
        flexDirection="column"
        justifyContent="flex-start"
      >
        <Text>{current.AirTemp}°C</Text>
        <Text>{current.Humidity}%</Text>
        <Text>{current.Pressure}mbar</Text>
        <Text>
          <Text color={current.Rainfall === "1" ? "#0000FF" : undefined}>
            {current.Rainfall === "1" ? "WET" : "DRY"}
          </Text>
        </Text>
        <Text><Text>{current.TrackTemp}</Text>°C</Text>
        <Text><Text>{current.WindDirection}</Text>°</Text>
        <Text><Text>{current.WindSpeed}</Text>m/s</Text>
      </Box>
    </Box>
  </Box>
);

export default WeatherData;
