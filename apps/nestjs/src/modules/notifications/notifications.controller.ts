import { Controller, Get, Patch, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@ApiTags('Notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @ApiOperation({ summary: 'Get unread count', description: 'Count of unread notifications for current user' })
  @Get('unread-count')
  unreadCount(@CurrentUser() user: any) {
    return this.svc.unreadCount(user.id);
  }

  /** GET /api/v1/notifications?page=&pageSize= — unread-first */
  @ApiOperation({ summary: 'List notifications', description: 'Paginated user notification feed with unread notifications listed first' })
  @Get()
  list(@CurrentUser() user: any, @Query('page') page?: string, @Query('pageSize') ps?: string) {
    const p = page ? parseInt(page, 10) : 1;
    const n = ps ? parseInt(ps, 10) : 20;
    return this.svc.listForUser(user.id, Number.isNaN(p) ? 1 : p, Number.isNaN(n) ? 20 : n);
  }

  /** PATCH /api/v1/notifications/read-all — must be before :id/read */
  @ApiOperation({ summary: 'Mark all as read', description: 'Mark all unread notifications for the user as read' })
  @Patch('read-all')
  markAllRead(@CurrentUser() user: any) {
    return this.svc.markAllRead(user.id);
  }

  /** PATCH /api/v1/notifications/:id/read */
  @ApiOperation({ summary: 'Mark single notification as read', description: 'Mark a specific notification ID as read' })
  @Patch(':id/read')
  markRead(@CurrentUser() user: any, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(user.id, id);
  }
}
