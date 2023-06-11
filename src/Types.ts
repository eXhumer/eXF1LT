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

export type SessionInfo = {
  Meeting: {
    Key: number;
    Name: string;
    OfficialName: string;
    Location: string;
    Country: {
      Key: number;
      Code: string;
      Name: string;
    };
    Circuit: {
      Key: number;
      ShortName: string;
    };
  };
  ArchiveStatus: {
    Status: string;
  };
  Key: number;
  Type: string;
  Name: string;
  StartDate: string;
  EndDate: string;
  GmtOffset: string;
  Path: string;
};

enum TSMessage {
  ALL_CLEAR = "AllClear",
  YELLOW = "Yellow",
  GREEN = "Green",
  SC_DEPLOYED = "SCDeployed",
  RED = "Red",
  VSC_DEPLOYED = "VSCDeployed",
  VSC_ENDING = "VSCEnding",
};

enum TSStatus {
  ALL_CLEAR = "1",
  YELLOW = "2",
  GREEN = "3",
  SC_DEPLOYED = "4",
  RED = "5",
  VSC_DEPLOYED = "6",
  VSC_ENDING = "7",
};

export type TrackStatus = {
  Status: TSStatus;
  Message: TSMessage;
};

export type WeatherData = {
  AirTemp: string;
  Humidity: string;
  Pressure: string;
  Rainfall: string;
  TrackTemp: string;
  WindDirection: string;
  WindSpeed: string;
};
