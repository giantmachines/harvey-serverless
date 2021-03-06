import * as _ from 'lodash';
import * as moment from 'moment';
import { APIGatewayEvent, Callback, Context } from 'aws-lambda';
import { AttachmentTransformer } from './attachment.transformer';
import { HarvestClient } from './harvest.client';
import { SlackClient } from './slack.client';
import { WebClient } from '@slack/web-api';
import strings from './strings.helper';

interface Options {
  harvest: HarvestClient;
  slackAPI: WebClient;
  slack?: SlackClient;
  execSlack?: SlackClient;
  testSlack?: SlackClient;
}

export class HarveyHandler {
  private harvest: HarvestClient;
  private slack: SlackClient;
  private execSlack: SlackClient;
  private testSlack: SlackClient;
  private slackAPI: WebClient;

  constructor({ harvest, slackAPI, slack, execSlack, testSlack }: Options) {
    this.harvest = harvest;
    this.slackAPI = slackAPI;
    this.slack = slack;
    this.execSlack = execSlack;
    this.testSlack = testSlack;
  }

  public handle = async (
    event: APIGatewayEvent,
    context: Context,
    cb: Callback
  ) => {
    try {
      // Determine start and end dates
      const to = moment().format('YYYY-MM-DD');
      const dayOfWeek = moment().day();

      let fromDelta;
      switch (dayOfWeek) {
        case 1: // Monday we actually look at last weeks timesheet.
          fromDelta = 7;
          break;
        case 2: // Tuesday
          fromDelta = 1;
          break;
        case 3: // Wednesday
          fromDelta = 2;
          break;
        case 4: // Thursday
          fromDelta = 3;
          break;
        case 5: // Friday
          fromDelta = 4;
          break;
      }

      // Setting the from to just be from the beginning of the week unless it is Monday.
      const from = moment().subtract(fromDelta, 'days').format('YYYY-MM-DD');

      // Fetch time entries and users from Harvest
      const [slackUsers, users, timeEntries] = await Promise.all([
        this.getSlackProfiles(),
        this.harvest.getUsers(),
        this.harvest.getTimeEntries({ from, to }),
      ]);
      // console.log('slackUsers', slackUsers);

      this.sendMessages(
        slackUsers,
        users,
        timeEntries,
        from,
        to,
        dayOfWeek,
        'general'
      );
      this.sendMessages(
        slackUsers,
        users,
        timeEntries,
        from,
        to,
        dayOfWeek,
        'exec'
      );

      cb(null, { statusCode: 200 });
    } catch (e) {
      console.log(e.message);

      cb(null, { statusCode: 200 });
    }
  };

  async sendMessages(
    slackUsers,
    users,
    timeEntries,
    from,
    to,
    dayOfWeek,
    type
  ) {
    // Create Slack attachments
    const attachments = this.createAttachments(
      slackUsers,
      users,
      timeEntries,
      type
    )
      // filter by only people who are missing MORE than 4 hours.
      .filter((a) => a.missing > 4);

    // Adding in the sorting logic for the attachments.
    attachments.sort((a, b) => {
      return b.missing - a.missing;
    });

    const slackIds = attachments
      .map((attachment) => attachment.slackId)
      .join(' ');

    // Set plain text fallback message
    const text =
      attachments.length > 0
        ? strings.withAttachments(slackIds, from, to, dayOfWeek)
        : strings.withoutAttachments(dayOfWeek);
    console.log('Text', text);
    console.log('attachments', attachments);

    // Post any message to test Slack channel
    if (this.testSlack) {
      await this.testSlack.postMessage({ text, attachments });
    }

    if (this.slack && this.execSlack) {
      if (type == 'exec') {
        await this.execSlack.postMessage({ text, attachments });
      } else {
        await this.slack.postMessage({ text, attachments });
      }
    }
  }

  async getSlackProfiles() {
    const response = await this.slackAPI.users.list();
    return response.members;
  }

  createAttachments(slackUsers, harvestUsers, timeEntries, type) {
    return harvestUsers
      .filter((harvestUser) => {
        if (type == 'exec') {
          return harvestUser.is_active && harvestUser.roles.includes('Exec');
        } else {
          return harvestUser.is_active && !harvestUser.roles.includes('Exec');
        }
      })
      .map((harvestUser) => {
        var slackUser = slackUsers.find((slackUser) => {
          return slackUser.profile.email == harvestUser.email;
        });
        if (slackUser) {
          harvestUser.slackId = slackUser.id;
        } else {
          console.log('****** MISSING SLACK USER', harvestUser);
        }
        return AttachmentTransformer.transform(
          harvestUser,
          timeEntries.filter((t) => harvestUser.id === t.user.id),
          harvestUser.roles.includes('Flexible') ? 0.8 : 1
        );
      });
  }
}
