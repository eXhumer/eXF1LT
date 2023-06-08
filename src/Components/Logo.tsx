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

export const LogoFactory = async () => {
  const ink = await import("ink");
  const Gradient = await import("@exhumer/ink-gradient");
  const BigText = await import("ink-big-text");

  return () => (
    <ink.Box borderStyle="round" paddingLeft={3} paddingRight={3}>
      <Gradient.default name="rainbow">
        <BigText.default text="eXF1LT" />
      </Gradient.default>
    </ink.Box>
  );
};
