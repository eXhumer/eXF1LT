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

type WeatherDataProps = {
  AirTemp: string;
  Humidity: string;
  Pressure: string;
  Rainfall: string;
  TrackTemp: string;
  WindDirection: string;
  WindSpeed: string;
};

const WeatherData = ({ AirTemp, Humidity, Pressure, Rainfall, TrackTemp, WindDirection,
            WindSpeed }: WeatherDataProps) => (
  <Box
    padding={1}
    borderStyle="round"
    flexDirection="column"
    justifyContent="flex-start"
    alignItems="center"
  >
    <Text underline bold>Weather Data</Text>
    <Text>Air Temperature: <Text color="#FF0000">{AirTemp}</Text></Text>
    <Text>Humidity: <Text color="#FF0000">{Humidity}</Text></Text>
    <Text>Pressure: <Text color="#FF0000">{Pressure}</Text></Text>
    <Text>Rainfall: <Text color="#FF0000">{Rainfall}</Text></Text>
    <Text>Track Temperature: <Text color="#FF0000">{TrackTemp}</Text></Text>
    <Text>Wind Direction: <Text color="#FF0000">{WindDirection}</Text></Text>
    <Text>Wind Speed: <Text color="#FF0000">{WindSpeed}</Text></Text>
  </Box>
);

export default WeatherData;
