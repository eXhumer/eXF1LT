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

type WeatherDataProps = {
  AirTemp: string;
  Humidity: string;
  Pressure: string;
  Rainfall: string;
  TrackTemp: string;
  WindDirection: string;
  WindSpeed: string;
};

export const WeatherDataFactory = async () => {
  const ink = await import("ink");

  return ({ AirTemp, Humidity, Pressure, Rainfall, TrackTemp, WindDirection,
            WindSpeed }: WeatherDataProps) => (
    <ink.Box
      padding={1}
      borderStyle="round"
      flexDirection="column"
      justifyContent="flex-start"
      alignItems="center"
    >
      <ink.Text underline bold>Weather Data</ink.Text>
      <ink.Text>Air Temperature: <ink.Text color="#FF0000">{AirTemp}</ink.Text></ink.Text>
      <ink.Text>Humidity: <ink.Text color="#FF0000">{Humidity}</ink.Text></ink.Text>
      <ink.Text>Pressure: <ink.Text color="#FF0000">{Pressure}</ink.Text></ink.Text>
      <ink.Text>Rainfall: <ink.Text color="#FF0000">{Rainfall}</ink.Text></ink.Text>
      <ink.Text>Track Temperature: <ink.Text color="#FF0000">{TrackTemp}</ink.Text></ink.Text>
      <ink.Text>Wind Direction: <ink.Text color="#FF0000">{WindDirection}</ink.Text></ink.Text>
      <ink.Text>Wind Speed: <ink.Text color="#FF0000">{WindSpeed}</ink.Text></ink.Text>
    </ink.Box>
  );
};
