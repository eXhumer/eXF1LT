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

export const deepMerge = (initial: { [x: string]: any; }, update: { [x: string]: any; }) => {
  for (const key in update) {
    if (key in initial) {
      if (typeof initial[key] in ["function", "symbol"])
        throw new Error("invalid value type!");

      else if (typeof initial[key] === "object") {
        if (Array.isArray(initial[key])) {
          if (Array.isArray(update[key]))
            initial[key] = update[key];

          else {
            if (typeof update[key] !== "object")
              throw new Error("data type change between initial and update!");

            for (const arrKey in update[key]) {
              if (parseInt(arrKey) < initial[key].length) {
                if (parseInt(arrKey) < 0)
                  throw new Error("invalid array key!");

                initial[key][arrKey] = deepMerge(initial[key][arrKey], update[key][arrKey]);
              }

              else
                initial[key][arrKey] = update[key][arrKey];
            }
            initial[key] = deepMerge(initial[key], update[key]);
          }
        }

        else {
          initial[key] = deepMerge(initial[key], update[key]);
        }
      }

      else
        initial[key] = update[key];
    } else
      initial[key] = update[key];
  }

  return initial;
};
